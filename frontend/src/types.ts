export interface Photo {
  id: number;
  file_path: string;
  thumbnail_path: string;
  taken_at: string | null;
  caption: string;
}

export interface Stop {
  id: number;
  city_name: string;
  longitude: number;
  latitude: number;
  arrival_date: string | null;
  departure_date: string | null;
  lodging: string;
  food: string;
  attractions: string;
  other: string;
  videos: string;
  articles: string;
  order: number;
  transport_mode: string;
  photos: Photo[];
}

export interface Route {
  id: number;
  name: string;
  year: number | null;
  color: string;
  description: string;
  is_favorite: boolean;
  qr_code_path: string;
  stops: Stop[];
}
