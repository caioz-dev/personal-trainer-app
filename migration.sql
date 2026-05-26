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
