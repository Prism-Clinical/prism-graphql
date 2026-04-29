import { use } from 'react';

export default function PathwayHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Version History</h1>
      <p className="text-sm text-gray-500">
        Pathway <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{id}</code>
      </p>
      <div className="mt-8 bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">
        Version history &amp; diffs — coming in Plan 6
      </div>
    </div>
  );
}
