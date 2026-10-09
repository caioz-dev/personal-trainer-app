-- ============================================================================
-- M1 + M2 · aplicada em: 2026-10-09 18:15
-- M2: volume e total_volume passam a ser derivados no banco (triggers).
-- M1: duplicar treino / rotina em uma transação só (RPCs SECURITY INVOKER).
-- Origem: migration_m1m2_proposta.sql (sha256 8324f95a…); testado com teste_zz_d2_m1m2.sql (T1–T16, PÓS ok).
-- Rollback: drop dos 3 triggers e das 5 funções (ver roteiro M1+M2).
-- ============================================================================

-- ── M2.1 volume do exercício = sets × reps × carga (aeróbico = 0) ─────────────
-- INVOKER: só mexe em NEW, não lê nem grava outras tabelas.
create or replace function public.we_set_volume()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.volume := case
    when coalesce(new.exercise_type, 'musculacao') = 'aerobico' then 0
    else round(coalesce(new.sets, 0) * coalesce(new.reps, 0) * coalesce(new.weight_kg, 0), 2)
  end;
  return new;
end $$;

drop trigger if exists workout_exercises_set_volume on public.workout_exercises;
create trigger workout_exercises_set_volume
  before insert or update of sets, reps, weight_kg, exercise_type, volume
  on public.workout_exercises
  for each row execute function public.we_set_volume();

-- ── M2.2 total_volume do treino = soma dos volumes dos exercícios ─────────────
-- INVOKER: quem consegue gravar em workout_exercises (criador do treino, com o treino
-- visível pela RLS — vínculo ativo ou o próprio aluno) também passa em workouts_update.
-- Assim o trigger não abre nenhum caminho que a RLS já não permita.
-- Não há caso de total desatualizado em silêncio: o USING de workouts_update
-- (created_by = auth.uid()) é a mesma condição exigida para gravar exercícios; se só o
-- WITH CHECK falhar (criador sem papel personal — hoje 0 treinos), o UPDATE dá 42501 e a
-- gravação do exercício é desfeita junto (testes T15 e T16).
create or replace function public.we_sync_total_volume()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ids uuid[] := '{}';
  v_id  uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_ids := v_ids || old.workout_id; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_ids := v_ids || new.workout_id; end if;
  for v_id in select distinct x from unnest(v_ids) x where x is not null loop
    update public.workouts w
       set total_volume = coalesce((select round(sum(e.volume), 2)
                                      from public.workout_exercises e
                                     where e.workout_id = v_id), 0)
     where w.id = v_id;
  end loop;
  return null;
end $$;

drop trigger if exists workout_exercises_sync_total on public.workout_exercises;
create trigger workout_exercises_sync_total
  after insert or update or delete
  on public.workout_exercises
  for each row execute function public.we_sync_total_volume();

-- ── M2.3 total_volume vindo do front é ignorado: sempre a soma real ──────────
-- INVOKER: lê workout_exercises do próprio treino que o usuário está gravando.
create or replace function public.w_derive_total_volume()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.total_volume := coalesce((select round(sum(e.volume), 2)
                                  from public.workout_exercises e
                                 where e.workout_id = new.id), 0);
  return new;
end $$;

drop trigger if exists workouts_derive_total_volume on public.workouts;
create trigger workouts_derive_total_volume
  before insert or update of total_volume
  on public.workouts
  for each row execute function public.w_derive_total_volume();

-- ── M1.1 duplicar treino (treino + exercícios, tudo ou nada) ─────────────────
create or replace function public.duplicate_workout(
  p_source_id   uuid,
  p_student_id  uuid,
  p_date        date,
  p_end_date    date default null,
  p_routine_id  uuid default null,
  p_day_of_week text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_src public.workouts;
  v_new uuid;
begin
  -- RLS de leitura: só enxerga a origem quem tem vínculo ativo com o aluno (ou é o aluno).
  select * into v_src from public.workouts where id = p_source_id;
  if not found then
    raise exception 'Treino de origem não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.workout_exercises where workout_id = p_source_id) then
    raise exception 'Nenhum exercício encontrado para duplicar.' using errcode = 'P0001';
  end if;
  if p_routine_id is not null and not exists (
       select 1 from public.routines r where r.id = p_routine_id and r.student_id = p_student_id) then
    raise exception 'Rotina de destino inválida para este aluno.' using errcode = 'P0001';
  end if;

  -- RLS de escrita (workouts_insert): created_by = auth.uid(), papel personal e vínculo
  -- ativo com o aluno de destino (ou o próprio personal). total_volume vem do trigger.
  insert into public.workouts (student_id, name, date, end_date, notes, routine_id, day_of_week, created_by)
  values (p_student_id, v_src.name, p_date, p_end_date, v_src.notes, p_routine_id,
          case when p_routine_id is null then null else p_day_of_week end, auth.uid())
  returning id into v_new;

  insert into public.workout_exercises (
    workout_id, exercise_name, exercise_type, sets, reps, weight_kg, volume,
    cadencia, tempo_descanso, training_method, method_description,
    duration_min, distance_km, speed_kmh, pace, hr_min, hr_max,
    recovery_interval_min, recovery_speed_kmh, position)
  select v_new, e.exercise_name, e.exercise_type, e.sets, e.reps, e.weight_kg, 0,
         e.cadencia, e.tempo_descanso, e.training_method, e.method_description,
         e.duration_min, e.distance_km, e.speed_kmh, e.pace, e.hr_min, e.hr_max,
         e.recovery_interval_min, e.recovery_speed_kmh, e.position
    from public.workout_exercises e
   where e.workout_id = p_source_id
   order by e.position;

  return v_new;
end $$;

-- ── M1.2 duplicar rotina (rotina + treinos + exercícios, tudo ou nada) ───────
create or replace function public.duplicate_routine(
  p_source_routine_id uuid,
  p_student_id        uuid,
  p_name              text,
  p_start             date,
  p_end               date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_src public.routines;
  v_new uuid;
  v_off integer;
  v_w   public.workouts;
  v_nw  uuid;
  v_n   integer := 0;
begin
  select * into v_src from public.routines where id = p_source_routine_id;
  if not found then
    raise exception 'Rotina de origem não encontrada.' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_name), '') = '' or p_start is null then
    raise exception 'Preencha nome e data de início.' using errcode = 'P0001';
  end if;
  if p_end is not null and p_end < p_start then
    raise exception 'A data de término não pode ser antes da data de início.' using errcode = 'P0001';
  end if;

  -- RLS (routines_insert): personal_id = auth.uid(), papel personal, vínculo ativo.
  insert into public.routines (personal_id, student_id, name, start_date, end_date,
                               show_to_student, auto_archive, general_instructions)
  values (auth.uid(), p_student_id, trim(p_name), p_start, p_end,
          coalesce(v_src.show_to_student, 'sempre'), coalesce(v_src.auto_archive, false),
          v_src.general_instructions)
  returning id into v_new;

  -- Mesmo deslocamento de datas do front: mantém o espaçamento relativo ao início original.
  v_off := case when v_src.start_date is null then 0 else p_start - v_src.start_date end;

  for v_w in
    select * from public.workouts where routine_id = p_source_routine_id order by date, created_at
  loop
    insert into public.workouts (student_id, name, date, end_date, notes, routine_id, day_of_week, created_by)
    values (p_student_id, v_w.name,
            case when v_src.start_date is null then p_start else v_w.date + v_off end,
            case when v_src.start_date is null then null    else v_w.end_date + v_off end,
            v_w.notes, v_new, v_w.day_of_week, auth.uid())
    returning id into v_nw;

    insert into public.workout_exercises (
      workout_id, exercise_name, exercise_type, sets, reps, weight_kg, volume,
      cadencia, tempo_descanso, training_method, method_description,
      duration_min, distance_km, speed_kmh, pace, hr_min, hr_max,
      recovery_interval_min, recovery_speed_kmh, position)
    select v_nw, e.exercise_name, e.exercise_type, e.sets, e.reps, e.weight_kg, 0,
           e.cadencia, e.tempo_descanso, e.training_method, e.method_description,
           e.duration_min, e.distance_km, e.speed_kmh, e.pace, e.hr_min, e.hr_max,
           e.recovery_interval_min, e.recovery_speed_kmh, e.position
      from public.workout_exercises e
     where e.workout_id = v_w.id
     order by e.position;

    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('routine_id', v_new, 'workouts', v_n);
end $$;

-- ── Permissões: só usuário logado chama as RPCs ──────────────────────────────
revoke all on function public.duplicate_workout(uuid, uuid, date, date, uuid, text) from public, anon;
grant execute on function public.duplicate_workout(uuid, uuid, date, date, uuid, text) to authenticated;
revoke all on function public.duplicate_routine(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.duplicate_routine(uuid, uuid, text, date, date) to authenticated;
