import { ProtectedLayout } from '@/components/layout/ProtectedLayout';

export default function MLModelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
