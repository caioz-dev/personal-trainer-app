-- ============================================================
-- PersonalPro - Script SQL para o Supabase
-- Execute no Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================

-- 1. TABELA DE PERFIS (id = auth.users.id)
CREATE TABLE IF NOT EXISTS public.profiles (
  id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name  TEXT NOT NULL,
  role  TEXT NOT NULL CHECK (role IN ('personal', 'student')),
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABELA DE TREINOS
CREATE TABLE IF NOT EXISTS public.workouts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg  NUMERIC(10,2) NOT NULL CHECK (weight_kg > 0),
  reps       INTEGER NOT NULL CHECK (reps > 0),
  volume     NUMERIC(10,2) NOT NULL,           -- peso × reps, calculado no cliente
  notes      TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_workouts_student_date
  ON public.workouts (student_id, date DESC);

-- 3. ATIVAR ROW LEVEL SECURITY
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts  ENABLE ROW LEVEL SECURITY;

-- 4. FUNÇÃO AUXILIAR (evita recursão nas policies de profiles)
--    Security definer: roda como owner, bypassa RLS ao consultar profiles
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- 5. POLICIES DE PROFILES
DROP POLICY IF EXISTS "users_read_own_profile"      ON public.profiles;
DROP POLICY IF EXISTS "personal_read_all_profiles"  ON public.profiles;
DROP POLICY IF EXISTS "users_insert_own_profile"    ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile"    ON public.profiles;

-- Cada usuário lê o próprio perfil
CREATE POLICY "users_read_own_profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Personal trainer lê todos os perfis
CREATE POLICY "personal_read_all_profiles" ON public.profiles
  FOR SELECT USING (public.get_my_role() = 'personal');

-- Usuário cria o próprio perfil no cadastro
CREATE POLICY "users_insert_own_profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Usuário atualiza o próprio perfil
CREATE POLICY "users_update_own_profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- 6. POLICY DE TREINOS (cobre SELECT, INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "workout_access" ON public.workouts;

CREATE POLICY "workout_access" ON public.workouts
  FOR ALL TO authenticated
  USING      (student_id = auth.uid() OR public.get_my_role() = 'personal')
  WITH CHECK (student_id = auth.uid() OR public.get_my_role() = 'personal');

-- ============================================================
-- IMPORTANTE: Desative a confirmação de e-mail para testes
-- Supabase Dashboard → Authentication → Providers → Email
-- → Desmarque "Confirm email"
-- ============================================================
