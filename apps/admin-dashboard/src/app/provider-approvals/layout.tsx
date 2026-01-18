import { ProtectedLayout } from '@/components/layout/ProtectedLayout';

export default function ProviderApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
