export default function PdfImportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Parent import-export layout already provides ProtectedLayout
  return <>{children}</>;
}
