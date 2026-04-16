/* eslint-disable */
// Extracted from: src/ui/page_blocks/dashboard/chat/ResponseMessage.tsx
import React from 'react';
import { LogoIconSmall } from '@/components/8flow/Icons';
import { LoaderDots } from '@/shared/ui';
import { parseMarkdownText } from './parseMarkdownText';
import { useTypewriter } from './useTypewriter';

interface Props {
  text: string;
  loading?: boolean;
  onAnimationEnd?: () => void;
}

export function ResponseMessage({ text, loading, onAnimationEnd }: Props) {
  const { currentText, isComplete } = useTypewriter(text, onAnimationEnd);

  return (
    <div className='flex items-start gap-3'>
      <LogoIconSmall />
      {loading ? <LoaderDots /> : <p>{isComplete ? parseMarkdownText(currentText) : currentText}</p>}
    </div>
  );
}
