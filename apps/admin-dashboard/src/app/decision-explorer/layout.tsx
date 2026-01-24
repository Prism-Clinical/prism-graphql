import { ProtectedLayout } from '@/components/layout/ProtectedLayout';

export default function DecisionExplorerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
