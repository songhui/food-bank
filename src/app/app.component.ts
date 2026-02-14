import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { geoMercator, geoPath } from 'd3-geo';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import type { Observable } from 'rxjs';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

interface MealSummary {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'other';
}

interface RankedMeal {
  meal: MealSummary;
  views: number;
}

interface AreaResponse {
  meals: Array<{ strArea: string }>;
}

interface MealsResponse {
  meals: MealSummary[] | null;
}

interface WikidataBinding {
  dish: { value: string };
  dishLabel: { value: string };
  image?: { value: string };
  articleTitle?: { value: string };
  mealType?: { value: string };
}

interface WikidataResponse {
  results: {
    bindings: WikidataBinding[];
  };
}

interface PageviewsResponse {
  items?: Array<{ views: number }>;
}

interface CountryPath {
  name: string;
  path: string;
  area: string | null;
  hasMeals: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'World Food Atlas';

  mapWidth = 2400;
  mapHeight = 1240;
  countries: CountryPath[] = [];
  loadingMap = true;
  placeholderImage = '/assets/meal-placeholder.svg';

  hoveredCountry: CountryPath | null = null;
  selectedCountry: CountryPath | null = null;
  meals: MealSummary[] = [];
  mealsByCategory: Record<'breakfast' | 'lunch' | 'dinner' | 'other', MealSummary[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    other: []
  };
  activeCategory: 'breakfast' | 'lunch' | 'dinner' | 'other' = 'breakfast';
  loadingMeals = false;

  private readonly geoJsonUrl =
    'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
  private readonly mealDbBase = 'https://www.themealdb.com/api/json/v1/1';

  private readonly areaAliases = new Map<string, string>([
    ['United States of America', 'American'],
    ['United States', 'American'],
    ['United Kingdom', 'British'],
    ['South Korea', 'Korean'],
    ['Korea, South', 'Korean'],
    ['Korea, Republic of', 'Korean'],
    ['Republic of Korea', 'Korean'],
    ['Czechia', 'Czech'],
    ['Czech Republic', 'Czech']
  ]);

  private mealsByCountry = new Map<string, MealSummary[]>();
  private mealsByArea = new Map<string, MealSummary[]>();
  private areas = new Set<string>();

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.loadInitialData();
  }

  onCountryHover(country: CountryPath): void {
    this.hoveredCountry = country;
  }

  onCountryLeave(): void {
    this.hoveredCountry = null;
  }

  onCountrySelect(country: CountryPath): void {
    if (this.selectedCountry?.name === country.name) {
      return;
    }

    this.selectedCountry = country;
    this.meals = [];
    this.mealsByCategory = { breakfast: [], lunch: [], dinner: [], other: [] };
    this.activeCategory = 'breakfast';

    this.fetchMealsForCountry(country.name, country.area);
  }

  clearSelection(): void {
    this.selectedCountry = null;
    this.meals = [];
    this.mealsByCategory = { breakfast: [], lunch: [], dinner: [], other: [] };
    this.loadingMeals = false;
  }

  private loadInitialData(): void {
    this.loadingMap = true;

    forkJoin({
      areas: this.http.get<AreaResponse>(`${this.mealDbBase}/list.php?a=list`).pipe(
        catchError(() => of({ meals: [] }))
      ),
      geojson: this.http.get<FeatureCollection<Geometry>>(this.geoJsonUrl)
    }).subscribe({
      next: ({ areas, geojson }) => {
        this.areas = new Set(areas.meals.map((area) => area.strArea));
        this.countries = this.buildCountryPaths(geojson);
        this.loadingMap = false;
      },
      error: () => {
        this.loadingMap = false;
      }
    });
  }

  private buildCountryPaths(geojson: FeatureCollection<Geometry>): CountryPath[] {
    const projection = geoMercator().fitSize([this.mapWidth, this.mapHeight], geojson as any);
    const pathGenerator = geoPath(projection);

    return geojson.features
      .filter((feature): feature is Feature<Geometry, { name?: string }> => !!feature)
      .map((feature) => {
        const name = feature.properties?.name ?? 'Unknown';
        const area = this.resolveArea(name);
        const hasMeals = true;
        const path = pathGenerator(feature as any) ?? '';
        return { name, area, path, hasMeals };
      })
      .filter((country) => country.path.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private fetchMealsForCountry(countryName: string, area: string | null): void {
    if (!area) {
      this.fetchWikidataMeals(countryName, []);
      return;
    }

    const cachedMeals = this.mealsByArea.get(area);
    if (cachedMeals) {
      this.fetchWikidataMeals(countryName, cachedMeals);
      return;
    }

    this.loadingMeals = true;

    this.http
      .get<MealsResponse>(`${this.mealDbBase}/filter.php?a=${encodeURIComponent(area)}`)
      .subscribe({
        next: (response) => {
          const meals = (response.meals ?? [])
            .slice(0, 60)
            .map((meal) => ({ ...meal, mealType: 'other' as const }));
          this.mealsByArea.set(area, meals);
          this.fetchWikidataMeals(countryName, meals);
        },
        error: () => {
          this.fetchWikidataMeals(countryName, []);
        }
      });
  }

  private fetchWikidataMeals(countryName: string, fallbackMeals: MealSummary[]): void {
    const cachedMeals = this.mealsByCountry.get(countryName);
    if (cachedMeals) {
      this.meals = cachedMeals;
      this.mealsByCategory = this.categorizeRankedMeals(
        cachedMeals.map((meal) => ({ meal, views: 0 }))
      );
      this.activeCategory = this.pickDefaultCategory(this.mealsByCategory);
      this.loadingMeals = false;
      return;
    }

    this.loadingMeals = true;

    const query = `
      SELECT ?dish ?dishLabel
        (SAMPLE(?image) AS ?image)
        (SAMPLE(?articleTitle) AS ?articleTitle)
        (SAMPLE(?mealType) AS ?mealType)
      WHERE {
        ?country rdfs:label "${countryName}"@en.
        {
          ?dish wdt:P495 ?country.
        }
        UNION
        {
          ?dish wdt:P2012 ?cuisine.
          ?cuisine (wdt:P495|wdt:P17) ?country.
        }
        ?dish wdt:P31/wdt:P279* ?type.
        VALUES ?type { wd:Q2095 wd:Q19861951 }
        OPTIONAL {
          ?dish wdt:P31/wdt:P279* ?mealType.
          VALUES ?mealType { wd:Q80973 wd:Q12896105 wd:Q657221 wd:Q568285 }
        }
        OPTIONAL { ?dish wdt:P18 ?image. }
        OPTIONAL {
          ?article schema:about ?dish;
            schema:inLanguage "en";
            schema:isPartOf <https://en.wikipedia.org/>;
            schema:name ?articleTitle.
        }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
      GROUP BY ?dish ?dishLabel
      LIMIT 120
    `;

    const params = new HttpParams().set('format', 'json').set('query', query);

    this.http
      .get<WikidataResponse>('https://query.wikidata.org/sparql', { params })
      .pipe(
        switchMap((response) => this.rankMealsByPageviews(response.results.bindings)),
        catchError(() => of([] as RankedMeal[]))
      )
      .subscribe((rankedMeals) => {
        const mergedRanked = this.mergeRankedMeals(rankedMeals, fallbackMeals);
        const categories = this.categorizeRankedMeals(mergedRanked);
        const resolvedMeals = mergedRanked.map((item) => item.meal);
        if (resolvedMeals.length > 0) {
          this.mealsByCountry.set(countryName, resolvedMeals);
        }
        this.meals = resolvedMeals;
        this.mealsByCategory = categories;
        this.activeCategory = this.pickDefaultCategory(this.mealsByCategory);
        this.loadingMeals = false;
      });
  }

  private rankMealsByPageviews(bindings: WikidataBinding[]): Observable<RankedMeal[]> {
    if (bindings.length === 0) {
      return of([] as RankedMeal[]);
    }

    const { start, end } = this.getPageviewDateRange();
    const entries = bindings.map((binding, index) => {
      const title = binding.articleTitle?.value ?? '';
      const safeTitle = title.replace(/ /g, '_');
      if (!safeTitle) {
        return of({
          meal: this.toMealSummary(binding, index),
          views: 0
        });
      }

      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(
        safeTitle
      )}/daily/${start}/${end}`;

      return this.http.get<PageviewsResponse>(url).pipe(
        map((response) => ({
          meal: this.toMealSummary(binding, index),
          views: (response.items ?? []).reduce((sum, item) => sum + item.views, 0)
        })),
        catchError(() =>
          of({
            meal: this.toMealSummary(binding, index),
            views: 0
          })
        )
      );
    });

    return forkJoin(entries).pipe(
      map((ranked) => {
        const sorted = ranked.sort((a, b) => b.views - a.views);
        const seen = new Set<string>();
        const unique: RankedMeal[] = [];

        for (const entry of sorted) {
          const key = entry.meal.strMeal.trim().toLowerCase();
          if (!key || seen.has(key)) {
            continue;
          }
          seen.add(key);
          unique.push(entry);
        }

        return unique;
      })
    );
  }

  private mergeRankedMeals(rankedMeals: RankedMeal[], fallbackMeals: MealSummary[]): RankedMeal[] {
    const merged: RankedMeal[] = [...rankedMeals];
    const seen = new Set(rankedMeals.map((item) => item.meal.strMeal.trim().toLowerCase()));

    for (const meal of fallbackMeals) {
      const key = meal.strMeal.trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({ meal, views: 0 });
    }

    return merged;
  }

  setActiveCategory(category: 'breakfast' | 'lunch' | 'dinner' | 'other'): void {
    this.activeCategory = category;
  }

  private categorizeRankedMeals(
    rankedMeals: RankedMeal[]
  ): Record<'breakfast' | 'lunch' | 'dinner' | 'other', MealSummary[]> {
    const categories: Record<'breakfast' | 'lunch' | 'dinner' | 'other', RankedMeal[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      other: []
    };

    for (const item of rankedMeals) {
      const category = this.pickCategory(item.meal);
      categories[category].push(item);
    }

    return {
      breakfast: categories.breakfast.sort((a, b) => b.views - a.views).slice(0, 10).map((item) => item.meal),
      lunch: categories.lunch.sort((a, b) => b.views - a.views).slice(0, 10).map((item) => item.meal),
      dinner: categories.dinner.sort((a, b) => b.views - a.views).slice(0, 10).map((item) => item.meal),
      other: categories.other.sort((a, b) => b.views - a.views).slice(0, 10).map((item) => item.meal)
    };
  }

  private pickDefaultCategory(
    categories: Record<'breakfast' | 'lunch' | 'dinner' | 'other', MealSummary[]>
  ): 'breakfast' | 'lunch' | 'dinner' | 'other' {
    if (categories.breakfast.length > 0) {
      return 'breakfast';
    }
    if (categories.lunch.length > 0) {
      return 'lunch';
    }
    if (categories.dinner.length > 0) {
      return 'dinner';
    }
    return 'other';
  }

  private toMealSummary(binding: WikidataBinding, index: number): MealSummary {
    return {
      idMeal: binding.dish.value.split('/').pop() ?? `wd-${index}`,
      strMeal: binding.dishLabel.value,
      strMealThumb: binding.image?.value ?? '',
      mealType: this.resolveMealType(binding.mealType?.value)
    };
  }

  private resolveArea(countryName: string): string | null {
    if (this.areas.has(countryName)) {
      return countryName;
    }

    const alias = this.areaAliases.get(countryName);
    if (alias && this.areas.has(alias)) {
      return alias;
    }

    return null;
  }

  private getPageviewDateRange(): { start: string; end: string } {
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 364);
    return {
      start: this.formatPageviewDate(startDate),
      end: this.formatPageviewDate(endDate)
    };
  }

  private formatPageviewDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}00`;
  }

  private resolveMealType(mealTypeUri?: string): 'breakfast' | 'lunch' | 'dinner' | 'other' {
    switch (mealTypeUri) {
      case 'http://www.wikidata.org/entity/Q80973':
        return 'breakfast';
      case 'http://www.wikidata.org/entity/Q12896105':
        return 'lunch';
      case 'http://www.wikidata.org/entity/Q657221':
      case 'http://www.wikidata.org/entity/Q568285':
        return 'dinner';
      default:
        return 'other';
    }
  }

  private pickCategory(meal: MealSummary): 'breakfast' | 'lunch' | 'dinner' | 'other' {
    if (meal.mealType && meal.mealType !== 'other') {
      return meal.mealType;
    }

    const label = meal.strMeal.toLowerCase();
    const breakfastKeywords = [
      'breakfast',
      'omelette',
      'omelet',
      'pancake',
      'waffle',
      'porridge',
      'congee',
      'toast',
      'cereal',
      'muffin',
      'croissant',
      'bagel',
      'granola',
      'yogurt',
      'coffee',
      'tea',
      'eggs',
      'bacon',
      'sausage'
    ];
    const dinnerKeywords = [
      'stew',
      'curry',
      'roast',
      'braise',
      'grill',
      'steak',
      'bbq',
      'barbecue',
      'hot pot',
      'tandoori',
      'biryani',
      'risotto',
      'ragù',
      'ragu',
      'kebab',
      'tagine',
      'casserole',
      'noodles',
      'ramen',
      'pho',
      'soup',
      'chowder',
      'goulash',
      'duck',
      'beef',
      'pork',
      'lamb'
    ];

    if (breakfastKeywords.some((word) => label.includes(word))) {
      return 'breakfast';
    }

    if (dinnerKeywords.some((word) => label.includes(word))) {
      return 'dinner';
    }

    return 'lunch';
  }
}
