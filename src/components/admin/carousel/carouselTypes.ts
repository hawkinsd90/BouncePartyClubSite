export interface CarouselMedia {
  id: string;
  image_url: string;
  media_type: 'image' | 'video';
  storage_path: string | null;
  title: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

export interface NewMediaState {
  file: File | null;
  url: string;
  title: string;
  description: string;
  mediaType: 'image' | 'video';
}
