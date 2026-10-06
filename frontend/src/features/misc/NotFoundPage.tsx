import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@/components/ui/Button';

/** Shown for a missing page AND for a page the user may not see — never hints that a record exists. */
export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-reading flex-col items-center gap-3 px-4 py-16 text-center">
      <Compass className="h-10 w-10 text-ink-muted" aria-hidden />
      <h1 className="text-2xl font-semibold text-ink">{t('notFound.title')}</h1>
      <p className="text-ink-muted">{t('notFound.body')}</p>
      <ButtonLink to="/" className="mt-2">
        {t('notFound.action')}
      </ButtonLink>
    </div>
  );
}
