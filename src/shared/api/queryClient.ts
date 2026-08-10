import { QueryClient, type VueQueryPluginOptions } from '@tanstack/vue-query'

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0,
      },
    },
  })
}

export const queryClientConfig: VueQueryPluginOptions = {
  queryClient: createAppQueryClient(),
}
