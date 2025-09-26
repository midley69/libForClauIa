/*
  # LiberTalk Database Setup - Safe Migration

  1. New Tables (if they don't exist)
    - `online_users` - Track users online status and activity
    - `groups` - Manage chat groups and their members

  2. Security
    - Enable RLS on both tables
    - Add public access policies for app functionality

  3. Performance
    - Add essential indexes for query optimization
*/

-- Create online_users table (only if it doesn't exist)
CREATE TABLE IF NOT EXISTS online_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text UNIQUE NOT NULL,
  status text NOT NULL CHECK (status IN ('online', 'chat', 'video', 'group')),
  location text,
  last_seen timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create groups table (only if it doesn't exist)
CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  member_count integer DEFAULT 1 CHECK (member_count >= 0),
  is_active boolean DEFAULT true,
  category text DEFAULT 'Créé par utilisateur',
  location text,
  last_activity timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  created_by text NOT NULL
);

-- Add indexes for online_users (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_online_users_last_seen ON online_users (last_seen);
CREATE INDEX IF NOT EXISTS idx_online_users_status ON online_users (status);
CREATE INDEX IF NOT EXISTS idx_online_users_user_id ON online_users (user_id);

-- Add indexes for groups (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups (is_active);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups (created_by);
CREATE INDEX IF NOT EXISTS idx_groups_last_activity ON groups (last_activity);
CREATE INDEX IF NOT EXISTS idx_groups_member_count ON groups (member_count);

-- Enable Row Level Security (safe to run multiple times)
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate them
DROP POLICY IF EXISTS "Allow all operations on online_users" ON online_users;
DROP POLICY IF EXISTS "Allow all operations on groups" ON groups;

-- Create policies for online_users
CREATE POLICY "Allow all operations on online_users" ON online_users
  FOR ALL USING (true) WITH CHECK (true);

-- Create policies for groups
CREATE POLICY "Allow all operations on groups" ON groups
  FOR ALL USING (true) WITH CHECK (true);