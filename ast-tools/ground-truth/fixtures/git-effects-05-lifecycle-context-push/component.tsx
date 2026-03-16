import { useEffect } from 'react';

interface MetricsProps {
  items: { label: string; value: number }[];
  data: Record<string, number> | undefined;
  isLoading: boolean;
}

interface Props {
  totals: Record<string, number> | undefined;
  isFetching: boolean;
  setHeaderMetricsProps: (props: MetricsProps | null) => void;
  metricsItems: { label: string; value: number }[];
}

export function SystemsContainerExtract({ totals, isFetching, setHeaderMetricsProps, metricsItems }: Props) {
  useEffect(() => {
    if (totals || isFetching) {
      setHeaderMetricsProps({
        items: metricsItems,
        data: totals,
        isLoading: isFetching,
      });
    }

    return () => setHeaderMetricsProps(null);
  }, [totals, isFetching, setHeaderMetricsProps, metricsItems]);

  return <section>Systems</section>;
}
