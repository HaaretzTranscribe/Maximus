-- Run this in Supabase SQL editor to set up the Maximus schema

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  url text unique not null,
  section text not null,
  title text not null,
  body text not null,
  word_count int not null,
  published_at timestamptz,
  fetched_at timestamptz default now(),
  status text not null default 'not_started',
  current_set boolean default true,
  tts_storage_path text
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) not null,
  started_at timestamptz default now(),
  ended_at timestamptz default now(),
  mode text,
  debate_transcript jsonb,
  overall_score int,
  error_explanation_hebrew text,
  error_categories jsonb
);

-- Storage bucket for TTS audio cache
-- Create via Supabase dashboard: Storage → New bucket → "tts-audio" (private)
