import { ObjectId } from 'mongodb';

export interface Localized<T> {
  en: T;
  [locale: string]: T;
}

export interface ImageObject {
  url: string;
  svg_content?: string;
  width?: number;
  height?: number;
  alt?: Localized<string>;
  size_in_kb?: number;
  mime_type?: string;
  blurhash?: string;
}

export interface OrientedImage {
  horizontal: Localized<ImageObject>;
  vertical: Localized<ImageObject>;
  square?: Localized<ImageObject>;
  ultrawide?: Localized<ImageObject>;
}

export interface GameModel {
  _id: ObjectId;
  identification: string;
  name: Localized<string>;
  platform: string;
  url: string;
  images: {
    hero: OrientedImage;
    carousel: { horizontal: unknown[]; vertical: unknown[] };
    thumbnail?: OrientedImage;
    icon?: ImageObject;
    logo?: ImageObject;
  };
  isReleased: boolean;
  isDownloadable: boolean;
  slogan?: Localized<string>;
  about?: unknown;
  category?: string;
  tags?: string[];
  rating?: number;
  metadata?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface GameListItemDto {
  identification: string;
  name: Localized<string>;
  thumbnail: OrientedImage;
  isDownloadable: boolean;
  category?: string;
  slogan?: Localized<string>;
  rating?: number;
  play_count?: number;
  metadata?: unknown;
  knowledge_facts?: string[];
}

export interface GameDetailDto extends GameListItemDto {
  url: string;
  about?: Localized<string>;
}

export interface AllGamesResponse {
  games: GameListItemDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CategoriesResponse {
  categories: string[];
}
