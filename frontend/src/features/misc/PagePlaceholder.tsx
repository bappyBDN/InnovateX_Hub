import { Hammer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/Layout';

/** Temporary stand-in so every route compiles; feature pages replace the files that use it. */
export function PagePlaceholder({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={name} />
      <EmptyState icon={<Hammer className="h-8 w-8" />} title={t('placeholder.body')} />
    </>
  );
}
