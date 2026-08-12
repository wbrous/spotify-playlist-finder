export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface PlaylistHit {
  id: string;
  name: string;
  ownerName: string;
  ownerId: string;
  url: string;
  images: SpotifyImage[];
  tracksTotal: number;
  description: string;
  public: boolean | null;
}

export interface RankedPlaylistHit extends PlaylistHit {
  /** 0..1, higher = better visual match. Only present in image-search results. */
  confidence: number;
}
