import type { Metadata } from 'next';
import { TasksList } from './TasksList';

export const metadata: Metadata = { title: 'Завдання' };

export default function TasksPage() {
  return <TasksList />;
}
