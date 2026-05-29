interface Props {
  title: string
  step?: string
}

export default function PlaceholderPage({ title, step }: Props) {
  return (
    <div className="bg-white rounded-xl shadow p-8">
      <h2 className="text-xl font-semibold text-gray-700 mb-2">{title}</h2>
      {step && (
        <p className="text-gray-400 text-sm">{step} 에서 구현 예정</p>
      )}
    </div>
  )
}
