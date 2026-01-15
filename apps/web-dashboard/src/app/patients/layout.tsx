import { ProtectedLayout } from '@/components/layout/ProtectedLayout';

export default function PatientsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
