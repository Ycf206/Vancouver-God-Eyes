import React from 'react';

export function SportShoeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className || 'w-4 h-4'}
      {...props}
    >
      {/* 運動鞋鞋底與鞋面輪廓 */}
      <path d="M3.5 17h17a1.5 1.5 0 0 0 1.5-1.5c0-1.5-1.2-2.5-3-2.5-1 0-1.8.4-2.5 1l-2.5-4a2 2 0 0 0-1.7-1h-2.6a2 2 0 0 0-1.7 1L8 13.5l-3-2c-1.5-1-3 0-3 1.5v2.5A1.5 1.5 0 0 0 3.5 17z" />
      {/* 防滑鞋底底座 */}
      <path d="M2 17v2a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2" />
      {/* 鞋帶細節 */}
      <path d="M9.5 11.5l1.5 2.5" />
      <path d="M12.5 11.5l1.5 2.5" />
    </svg>
  );
}
export default SportShoeIcon;
