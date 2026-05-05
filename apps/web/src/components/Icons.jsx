export const Icon = ({ name, size = 18, ...props }) => {
  const paths = {
    home: <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V11z" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
    library: <><path d="M4 4h2v16H4zM8 4h2v16H8zM13 5l8 3-1 3-8-3z" /></>,
    play: <path d="M6 4l14 8-14 8z" />,
    pause: <><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></>,
    next: <><path d="M5 4l10 8-10 8z" /><path d="M16 4h2v16h-2z" /></>,
    prev: <><path d="M19 4L9 12l10 8z" /><path d="M6 4h2v16H6z" /></>,
    heart: <path d="M12 21s-7-4.5-9.5-9.5C.5 7 4 4 7.5 4c2 0 3.5 1 4.5 2.5C13 5 14.5 4 16.5 4 20 4 23.5 7 21.5 11.5 19 16.5 12 21 12 21z" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
    volume: <><path d="M3 10v4h4l5 4V6L7 10H3z" /><path d="M16 8a5 5 0 0 1 0 8" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  };
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
};

export const PlayIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 4l14 8-14 8z" />
  </svg>
);
export const PauseIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
);
