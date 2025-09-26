/*
  # Complete LiberTalk Database Setup

  1. New Tables
    - `online_users` - Track users currently online with their status
    - `groups` - Manage chat groups and their members

  2. Security
    - Enable RLS on both tables
    - Add policies for public access (simplified for demo)

  3. Test Data
    - Insert sample users and groups for testing
    - Realistic data for immediate functionality

  4. Indexes
    - Performance indexes for common queries
    - Unique constraints where needed
*/

-- Drop existing tables if they exist (clean slate)
DROP TABLE IF EXISTS online_users CASCADE;
DROP TABLE IF EXISTS groups CASCADE;

-- Create online_users table
CREATE TABLE online_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('online', 'chat', 'video', 'group')),
  location text,
  last_seen timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create groups table
CREATE TABLE groups (
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

-- Enable Row Level Security
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (simplified for demo)
CREATE POLICY "Allow all operations on online_users" 
  ON online_users 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);

CREATE POLICY "Allow all operations on groups" 
  ON groups 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_online_users_user_id ON online_users(user_id);
CREATE INDEX IF NOT EXISTS idx_online_users_status ON online_users(status);
CREATE INDEX IF NOT EXISTS idx_online_users_last_seen ON online_users(last_seen);

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups(is_active);
CREATE INDEX IF NOT EXISTS idx_groups_last_activity ON groups(last_activity);
CREATE INDEX IF NOT EXISTS idx_groups_member_count ON groups(member_count);

-- Insert test data for online_users
INSERT INTO online_users (user_id, status, location, last_seen) VALUES
  ('test_user_1', 'online', 'Paris', now()),
  ('test_user_2', 'chat', 'Lyon', now() - interval '30 seconds'),
  ('test_user_3', 'video', 'Marseille', now() - interval '1 minute'),
  ('test_user_4', 'group', 'Toulouse', now() - interval '45 seconds'),
  ('test_user_5', 'online', 'Nice', now() - interval '2 minutes');

-- Insert test data for groups
INSERT INTO groups (name, description, member_count, created_by, location, last_activity) VALUES
  ('Développeurs Web', 'Discussion sur les technologies web modernes', 8, 'test_user_1', 'France', now()),
  ('Gamers FR', 'Communauté de joueurs français', 15, 'test_user_2', 'France', now() - interval '5 minutes'),
  ('Étudiants', 'Entraide entre étudiants', 12, 'test_user_3', 'Paris', now() - interval '3 minutes'),
  ('Cuisine & Recettes', 'Partage de recettes et conseils culinaires', 6, 'test_user_4', 'Lyon', now() - interval '8 minutes'),
  ('Voyageurs', 'Conseils et récits de voyage', 9, 'test_user_5', 'Marseille', now() - interval '2 minutes');

-- Verify the setup
SELECT 'online_users table created with ' || count(*) || ' test users' as status FROM online_users
UNION ALL
SELECT 'groups table created with ' || count(*) || ' test groups' as status FROM groups;