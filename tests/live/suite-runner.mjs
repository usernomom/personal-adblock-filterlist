/** Run every case and retain failures for investigation after the suite. */
export function createSuite({ onResult = () => {} } = {}) {
  const results = [];
  return {
    async run(name, task) {
      const started = performance.now();
      let item;
      try {
        const value = await task();
        item = { name, status:'pass', seconds:(performance.now()-started)/1000, value };
      } catch (error) {
        item = { name, status:'fail', seconds:(performance.now()-started)/1000,
                 error:error instanceof Error ? error.message : String(error) };
      }
      results.push(item);
      onResult(item);
      return item.value;
    },
    summary() {
      return { ok:results.every(item => item.status === 'pass'),
               cases:[...results], failures:results.filter(item => item.status === 'fail') };
    },
  };
}
