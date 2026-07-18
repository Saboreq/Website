export type Visibility = 'public' | 'private';
export type AppRole = 'owner' | 'admin' | 'user';

export interface ProfileRecord {
  id: string;
  email: string;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface InviteRecord {
  id: string;
  label: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  disabled_at: string | null;
  created_at: string;
  created_by: string | null;
  target_role: Exclude<AppRole, 'owner'>;
}

export interface CreatedInvite extends InviteRecord {
  code: string;
}

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
