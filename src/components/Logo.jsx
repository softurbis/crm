export default function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="Urbis Group">
      <polygon points="50,4 63,17 50,30 37,17" fill="#8C9B7A" />
      <polygon points="33,14 47,26 47,64 33,52" fill="#8C9B7A" />
      <polygon points="67,14 53,26 53,64 67,52" fill="#3B4A32" />
      <polygon points="8,50 30,50 44,64 22,64" fill="#8C9B7A" />
      <polygon points="92,50 70,50 56,64 78,64" fill="#3B4A32" />
    </svg>
  )
}
