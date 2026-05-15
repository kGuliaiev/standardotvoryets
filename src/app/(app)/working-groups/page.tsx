import type { Metadata } from 'next';
import { WorkingGroupsList } from './WorkingGroupsList';

export const metadata: Metadata = { title: 'Робочі групи' };

export default function WorkingGroupsPage() {
  return <WorkingGroupsList />;
}
