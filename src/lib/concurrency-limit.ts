export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const limit = Math.max(1, Math.floor(concurrency))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(runners)
  return results
}
