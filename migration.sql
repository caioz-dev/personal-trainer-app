-- Adaptar workouts para sessões de treino com múltiplos exercícios
ALTER TABLE public.workouts ALTER COLUMN weight_kg DROP NOT NULL;
ALTER TABLE public.workouts ALTER COLUMN reps       DROP NOT NULL;
ALTER TABLE public.workouts ALTER COLUMN volume     DROP NOT NULL;

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS total_volume NUMERIC(10,2) DEFAULT 0;

UPDATE public.workouts
  SET total_volume = COALESCE(volume, 0)
  WHERE total_volume = 0 OR total_volume IS NULL;

-- Nova tabela de exercícios por treino
CREATE TABLE IF NOT EXISTS public.workout_exercises (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sets       INTEGER NOT NULL CHECK (sets > 0),
  weight_kg  NUMERIC(10,2) NOT NULL CHECK (weight_kg > 0),
  reps       INTEGER NOT NULL CHECK (reps > 0),
  volume     NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercises_workout
  ON public.workout_exercises (workout_id);

ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercise_access" ON public.workout_exercises
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workouts w
      WHERE w.id = workout_id
      AND (w.student_id = auth.uid() OR public.get_my_role() = 'personal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workouts w
      WHERE w.id = workout_id
      AND (w.student_id = auth.uid() OR public.get_my_role() = 'personal')
    )
  );
