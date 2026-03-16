import { createContext, ReactNode, useContext, useEffect, useRef } from 'react';
import posthog, { PostHog } from 'posthog-js';
import { Router } from 'next/router';

interface Props {
  children: ReactNode;
}

interface PosthogContextProps {
  posthogClient: PostHog | void;
}

const PosthogProviderContext = createContext<PosthogContextProps | null>(null);

export function PosthogProvider({ children }: Props) {
  const posthogClient = undefined as PostHog | void;
  const oldUrlRef = useRef('');

  useEffect(() => {
    const handleRouteChange = () => posthog?.capture('$pageview');
    const handleRouteChangeStart = () =>
      posthog?.capture('$pageleave', {
        $current_url: oldUrlRef.current,
      });

    Router.events.on('routeChangeComplete', handleRouteChange);
    Router.events.on('routeChangeStart', handleRouteChangeStart);

    return () => {
      Router.events.off('routeChangeComplete', handleRouteChange);
      Router.events.off('routeChangeStart', handleRouteChangeStart);
    };
  }, []);

  return <PosthogProviderContext.Provider value={{ posthogClient }}>{children}</PosthogProviderContext.Provider>;
}
