// A deck's screen under the Aberturas header: the board as large as the
// height left allows, the panel beside it. Its drill and its Punir share it,
// so the board keeps its size and place from one to the other.
export function Frame({ board, children }: { board: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-4 lg:flex-row lg:px-8">
      <div className="flex min-w-0 justify-center lg:flex-1">
        <div className="w-full" style={{ maxWidth: 'calc(100vh - 150px)' }}>{board}</div>
      </div>
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-[400px]">{children}</aside>
    </div>
  );
}
