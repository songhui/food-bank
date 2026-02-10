import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { geoMercator, geoPath } from 'd3-geo';
import { catchError, forkJoin, of } from 'rxjs';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

interface AreaResponse {
  meals: Array<{ strArea: string }>;
}

interface MealSummary {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
}

interface WikiSummary {
  thumbnail?: {
    source: string;
  };
}

interface MealsResponse {
  meals: MealSummary[] | null;
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
  loadingMeals = false;

  private readonly mealDbBase = 'https://www.themealdb.com/api/json/v1/1';
  private readonly geoJsonUrl =
    'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';

  private readonly areaAliases = new Map<string, string>([
    ['China', 'Chinese'],
    ['Japan', 'Japanese'],
    ['India', 'Indian'],
    ['Norway', 'Norwegian'],
    ['France', 'French'],
    ['Italy', 'Italian'],
    ['South Korea', 'Korean'],
    ['Korea, South', 'Korean'],
    ['Korea, Republic of', 'Korean'],
    ['Republic of Korea', 'Korean'],
    ['United States of America', 'American'],
    ['United States', 'American'],
    ['United Kingdom', 'British'],
    ['Russia', 'Russian'],
    ['Vietnam', 'Vietnamese'],
    ['Czechia', 'Czech'],
    ['Czech Republic', 'Czech'],
    ['Korea, North', 'Korean'],
    ['North Korea', 'Korean']
  ]);

  private areas = new Set<string>();
  private mealsByArea = new Map<string, MealSummary[]>();
  private readonly wikiTitleOverrides = new Map<string, string>([
    ['Tteokbokki', 'Tteokbokki'],
    ['Kimchi Jjigae', 'Kimchi-jjigae'],
    ['Sundubu-jjigae', 'Sundubu-jjigae'],
    ['Samgyeopsal', 'Samgyeopsal'],
    ['Naengmyeon', 'Naengmyeon'],
    ['Japchae', 'Japchae'],
    ['Galbi', 'Galbi'],
    ['Bulgogi', 'Bulgogi'],
    ['Bibimbap', 'Bibimbap'],
    ['Kimchi', 'Kimchi'],
    ['Peking Duck', 'Peking duck'],
    ['Mapo Tofu', 'Mapo tofu'],
    ['Kung Pao Chicken', 'Kung Pao chicken'],
    ['Hot Pot', 'Hot pot'],
    ['Dim Sum', 'Dim sum'],
    ['Xiaolongbao', 'Xiaolongbao'],
    ['Chow Mein', 'Chow mein'],
    ['Sweet and Sour Pork', 'Sweet and sour pork'],
    ['Char Siu', 'Char siu'],
    ['Dan Dan Noodles', 'Dan dan noodles'],
    ['Jollof Rice', 'Jollof rice'],
    ['Suya', 'Suya'],
    ['Egusi Soup', 'Egusi soup'],
    ['Pounded Yam', 'Pounded yam'],
    ['Moi Moi', 'Moi moi'],
    ['Injera', 'Injera'],
    ['Doro Wat', 'Doro wat'],
    ['Kitfo', 'Kitfo'],
    ['Shiro', 'Shiro (food)'],
    ['Tibs', 'Tibs'],
    ['Tagine', 'Tagine'],
    ['Couscous', 'Couscous'],
    ['Pastilla', 'Pastilla'],
    ['Harira', 'Harira'],
    ['Rfissa', 'Rfissa'],
    ['Bunny Chow', 'Bunny chow'],
    ['Bobotie', 'Bobotie'],
    ['Boerewors', 'Boerewors'],
    ['Biltong', 'Biltong'],
    ['Gatsby', 'Gatsby (sandwich)'],
    ['Paella', 'Paella'],
    ['Tortilla Espanola', 'Spanish omelette'],
    ['Gazpacho', 'Gazpacho'],
    ['Jamón ibérico', 'Jamón ibérico'],
    ['Croquetas', 'Croquette'],
    ['Pulpo a la gallega', 'Pulpo a la gallega'],
    ['Patatas bravas', 'Patatas bravas'],
    ['Pisto', 'Pisto'],
    ['Churros', 'Churro'],
    ['Bacalao a la vizcaina', 'Bacalao a la vizcaína']
  ]);
  private readonly fallbackMealsByCountry = new Map<string, MealSummary[]>([
    [
      'South Korea',
      [
        { idMeal: 'kr-1', strMeal: 'Bibimbap', strMealThumb: '' },
        { idMeal: 'kr-2', strMeal: 'Kimchi', strMealThumb: '' },
        { idMeal: 'kr-3', strMeal: 'Bulgogi', strMealThumb: '' },
        { idMeal: 'kr-4', strMeal: 'Japchae', strMealThumb: '' },
        { idMeal: 'kr-5', strMeal: 'Tteokbokki', strMealThumb: '' },
        { idMeal: 'kr-6', strMeal: 'Samgyeopsal', strMealThumb: '' },
        { idMeal: 'kr-7', strMeal: 'Galbi', strMealThumb: '' },
        { idMeal: 'kr-8', strMeal: 'Sundubu-jjigae', strMealThumb: '' },
        { idMeal: 'kr-9', strMeal: 'Naengmyeon', strMealThumb: '' },
        { idMeal: 'kr-10', strMeal: 'Kimchi Jjigae', strMealThumb: '' }
      ]
    ],
    ['Korea, South', []],
    ['Republic of Korea', []],
    ['Korea, Republic of', []],
    [
      'China',
      [
        { idMeal: 'cn-1', strMeal: 'Peking Duck', strMealThumb: '' },
        { idMeal: 'cn-2', strMeal: 'Mapo Tofu', strMealThumb: '' },
        { idMeal: 'cn-3', strMeal: 'Kung Pao Chicken', strMealThumb: '' },
        { idMeal: 'cn-4', strMeal: 'Hot Pot', strMealThumb: '' },
        { idMeal: 'cn-5', strMeal: 'Dim Sum', strMealThumb: '' },
        { idMeal: 'cn-6', strMeal: 'Xiaolongbao', strMealThumb: '' },
        { idMeal: 'cn-7', strMeal: 'Chow Mein', strMealThumb: '' },
        { idMeal: 'cn-8', strMeal: 'Sweet and Sour Pork', strMealThumb: '' },
        { idMeal: 'cn-9', strMeal: 'Char Siu', strMealThumb: '' },
        { idMeal: 'cn-10', strMeal: 'Dan Dan Noodles', strMealThumb: '' }
      ]
    ],
    ["China, People's Republic of", []],
    ["People's Republic of China", []],
    [
      'Nigeria',
      [
        { idMeal: 'ng-1', strMeal: 'Jollof Rice', strMealThumb: '' },
        { idMeal: 'ng-2', strMeal: 'Suya', strMealThumb: '' },
        { idMeal: 'ng-3', strMeal: 'Egusi Soup', strMealThumb: '' },
        { idMeal: 'ng-4', strMeal: 'Pounded Yam', strMealThumb: '' },
        { idMeal: 'ng-5', strMeal: 'Moi Moi', strMealThumb: '' },
        { idMeal: 'ng-6', strMeal: 'Ofada Rice', strMealThumb: '' },
        { idMeal: 'ng-7', strMeal: 'Pepper Soup', strMealThumb: '' },
        { idMeal: 'ng-8', strMeal: 'Akara', strMealThumb: '' },
        { idMeal: 'ng-9', strMeal: 'Boli', strMealThumb: '' },
        { idMeal: 'ng-10', strMeal: 'Efo Riro', strMealThumb: '' }
      ]
    ],
    [
      'Ethiopia',
      [
        { idMeal: 'et-1', strMeal: 'Injera', strMealThumb: '' },
        { idMeal: 'et-2', strMeal: 'Doro Wat', strMealThumb: '' },
        { idMeal: 'et-3', strMeal: 'Kitfo', strMealThumb: '' },
        { idMeal: 'et-4', strMeal: 'Shiro', strMealThumb: '' },
        { idMeal: 'et-5', strMeal: 'Tibs', strMealThumb: '' },
        { idMeal: 'et-6', strMeal: 'Misir Wat', strMealThumb: '' },
        { idMeal: 'et-7', strMeal: 'Gomen', strMealThumb: '' },
        { idMeal: 'et-8', strMeal: 'Alicha', strMealThumb: '' },
        { idMeal: 'et-9', strMeal: 'Beyaynetu', strMealThumb: '' },
        { idMeal: 'et-10', strMeal: 'Tej', strMealThumb: '' }
      ]
    ],
    [
      'Morocco',
      [
        { idMeal: 'ma-1', strMeal: 'Tagine', strMealThumb: '' },
        { idMeal: 'ma-2', strMeal: 'Couscous', strMealThumb: '' },
        { idMeal: 'ma-3', strMeal: 'Pastilla', strMealThumb: '' },
        { idMeal: 'ma-4', strMeal: 'Harira', strMealThumb: '' },
        { idMeal: 'ma-5', strMeal: 'Rfissa', strMealThumb: '' },
        { idMeal: 'ma-6', strMeal: 'Mechoui', strMealThumb: '' },
        { idMeal: 'ma-7', strMeal: 'Zaalouk', strMealThumb: '' },
        { idMeal: 'ma-8', strMeal: 'Bastilla', strMealThumb: '' },
        { idMeal: 'ma-9', strMeal: 'Bissara', strMealThumb: '' },
        { idMeal: 'ma-10', strMeal: 'Msemen', strMealThumb: '' }
      ]
    ],
    [
      'South Africa',
      [
        { idMeal: 'za-1', strMeal: 'Bunny Chow', strMealThumb: '' },
        { idMeal: 'za-2', strMeal: 'Bobotie', strMealThumb: '' },
        { idMeal: 'za-3', strMeal: 'Boerewors', strMealThumb: '' },
        { idMeal: 'za-4', strMeal: 'Biltong', strMealThumb: '' },
        { idMeal: 'za-5', strMeal: 'Gatsby', strMealThumb: '' },
        { idMeal: 'za-6', strMeal: 'Braai', strMealThumb: '' },
        { idMeal: 'za-7', strMeal: 'Pap', strMealThumb: '' },
        { idMeal: 'za-8', strMeal: 'Chakalaka', strMealThumb: '' },
        { idMeal: 'za-9', strMeal: 'Koeksister', strMealThumb: '' },
        { idMeal: 'za-10', strMeal: 'Malva Pudding', strMealThumb: '' }
      ]
    ],
    ['South Africa (Republic of)', []],
    [
      'Spain',
      [
        { idMeal: 'es-1', strMeal: 'Paella', strMealThumb: '' },
        { idMeal: 'es-2', strMeal: 'Tortilla Espanola', strMealThumb: '' },
        { idMeal: 'es-3', strMeal: 'Gazpacho', strMealThumb: '' },
        { idMeal: 'es-4', strMeal: 'Jamón ibérico', strMealThumb: '' },
        { idMeal: 'es-5', strMeal: 'Croquetas', strMealThumb: '' },
        { idMeal: 'es-6', strMeal: 'Pulpo a la gallega', strMealThumb: '' },
        { idMeal: 'es-7', strMeal: 'Patatas bravas', strMealThumb: '' },
        { idMeal: 'es-8', strMeal: 'Pisto', strMealThumb: '' },
        { idMeal: 'es-9', strMeal: 'Churros', strMealThumb: '' },
        { idMeal: 'es-10', strMeal: 'Bacalao a la vizcaina', strMealThumb: '' }
      ]
    ]
  ]);

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

    const fallbackMeals = this.getFallbackMeals(country.name);
    const forceFallback = country.name === 'China'
      || country.name === "China, People's Republic of"
      || country.name === "People's Republic of China"
      || country.name === 'Nigeria'
      || country.name === 'Ethiopia'
      || country.name === 'Morocco'
      || country.name === 'South Africa'
      || country.name === 'South Africa (Republic of)'
      || country.name === 'Spain';

    if (!country.area || forceFallback) {
      if (fallbackMeals) {
        this.meals = fallbackMeals;
        this.loadFallbackImages(this.meals);
      }
      this.loadingMeals = false;
      return;
    }

    this.loadingMeals = true;

    const cachedMeals = this.mealsByArea.get(country.area);
    if (cachedMeals) {
      this.meals = cachedMeals;
      this.loadingMeals = false;
      return;
    }

    this.http
      .get<MealsResponse>(`${this.mealDbBase}/filter.php?a=${encodeURIComponent(country.area)}`)
      .subscribe({
        next: (response) => {
          const meals = (response.meals ?? []).slice(0, 10);
          if (meals.length > 0) {
            this.mealsByArea.set(country.area as string, meals);
            this.meals = meals;
          } else if (fallbackMeals) {
            this.meals = fallbackMeals;
            this.loadFallbackImages(this.meals);
          } else {
            this.meals = [];
          }
          this.loadingMeals = false;
        },
        error: () => {
          this.meals = fallbackMeals ?? [];
          if (this.meals.length > 0) {
            this.loadFallbackImages(this.meals);
          }
          this.loadingMeals = false;
        }
      });
  }

  clearSelection(): void {
    this.selectedCountry = null;
    this.meals = [];
    this.loadingMeals = false;
  }

  private loadInitialData(): void {
    this.loadingMap = true;

    forkJoin({
      areas: this.http.get<AreaResponse>(`${this.mealDbBase}/list.php?a=list`),
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
        const hasMeals = !!area || this.hasFallbackMealsForCountry(name);
        const path = pathGenerator(feature as any) ?? '';
        return { name, area, path, hasMeals };
      })
      .filter((country) => country.path.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private resolveArea(countryName: string): string | null {
    if (this.areas.has(countryName)) {
      return countryName;
    }

    const alias = this.areaAliases.get(countryName);
    if (alias) {
      return alias;
    }

    return null;
  }

  private getFallbackMeals(countryName: string): MealSummary[] | null {
    if (this.fallbackMealsByCountry.has(countryName)) {
      const fallback = this.fallbackMealsByCountry.get(countryName);
      if (fallback && fallback.length > 0) {
        return fallback;
      }
      return this.fallbackMealsByCountry.get('South Korea') ?? null;
    }

    return null;
  }

  private hasFallbackMealsForCountry(countryName: string): boolean {
    const fallback = this.getFallbackMeals(countryName);
    return !!fallback && fallback.length > 0;
  }

  private loadFallbackImages(meals: MealSummary[]): void {
    const requests = meals.map((meal) => {
      if (meal.strMealThumb) {
        return of(null);
      }

      const wikiTitle = this.wikiTitleOverrides.get(meal.strMeal) ?? meal.strMeal;
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
      return this.http.get<WikiSummary>(url).pipe(catchError(() => of(null)));
    });

    forkJoin(requests).subscribe((responses) => {
      responses.forEach((summary, index) => {
        const thumb = summary?.thumbnail?.source;
        if (thumb) {
          meals[index].strMealThumb = thumb;
        }
      });
    });
  }
}
