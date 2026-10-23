import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { Task } from '@/domain/tasks/task-types';
import {
  type SupabaseTaskRepository,
  TaskWriteConflictError,
} from '@/services/tasks/supabase-task-repository';

export function useTasks(repository: SupabaseTaskRepository) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  const loadSequence = useRef(0);
  const writing = useRef(false);
  const ready = tasks !== null;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      loadSequence.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || writing.current) return;

    const sequence = ++loadSequence.current;

    setLoading(true);
    setError(null);

    try {
      const values = await repository.list();

      if (mounted.current && sequence === loadSequence.current) {
        setTasks(values);
      }
    } catch {
      if (mounted.current && sequence === loadSequence.current) {
        setError('Tasks could not be loaded. Please refresh and try again.');
      }
    } finally {
      if (mounted.current && sequence === loadSequence.current) {
        setLoading(false);
      }
    }
  }, [repository]);

  useFocusEffect(useCallback(() => {
    void refresh();

    return () => {
      loadSequence.current += 1;
    };
  }, [refresh]));

  const save = useCallback(async (
    operation: (repository: SupabaseTaskRepository) => Promise<Task>,
  ): Promise<boolean> => {
    if (!mounted.current || writing.current || !ready) {
      return false;
    }

    writing.current = true;
    loadSequence.current += 1;

    setPending(true);
    setLoading(false);
    setError(null);

    try {
      const saved = await operation(repository);

      if (!mounted.current) return false;

      setTasks((current) => {
        const values = current ?? [];

        return values.some((task) => task.id === saved.id)
          ? values.map((task) => task.id === saved.id ? saved : task)
          : [...values, saved];
      });

      return true;
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof TaskWriteConflictError
            ? failure.message
            : 'The change could not be confirmed. Refresh before retrying.',
        );
      }

      return false;
    } finally {
      writing.current = false;

      if (mounted.current) {
        setPending(false);
      }
    }
  }, [ready, repository]);

  return {
    tasks: tasks ?? [],
    ready,
    loading,
    pending,
    error,
    refresh,
    save,
  };
}
