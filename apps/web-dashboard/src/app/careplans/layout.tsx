import { ProtectedLayout } from '@/components/layout/ProtectedLayout';

export default function CarePlansLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
