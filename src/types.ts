export type Visibility = 'public' | 'private';

export interface FolderRecord {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  is_private: boolean;
  created_at: string;
}

export interface FileRecord {
  id: string;
  owner_id: string;
  folder_id: string | null;
  name: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export interface DirectoryContents {
  folders: FolderRecord[];
  files: FileRecord[];
}
