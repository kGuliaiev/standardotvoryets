import type { Metadata } from 'next';
import { TaskDetail } from './TaskDetail';

export const metadata: Metadata = { title: 'Завдання' };

export default function TaskPage({ params }: { params: { id: string } }) {
  return <TaskDetail id={params.id} />;
}
