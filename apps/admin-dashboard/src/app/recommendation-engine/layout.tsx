import { ProtectedLayout } from '@/components/layout/ProtectedLayout';

export default function RecommendationEngineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
