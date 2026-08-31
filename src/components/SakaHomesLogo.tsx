import React from 'react';

interface SakaHomesLogoProps {
  variant?: 'full' | 'mark' | 'white';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showSubtitle?: boolean;
}

export default function SakaHomesLogo({
  variant = 'full',
  size = 'md',
  className = '',
  showSubtitle = false
}: SakaHomesLogoProps) {
  // Size dimensions
  const dimensions = {
    sm: { height: 'h-8', width: 'w-auto', iconSize: 28, textSize: 'text-base' },
    md: { height: 'h-10', width: 'w-auto', iconSize: 36, textSize: 'text-xl' },
    lg: { height: 'h-14', width: 'w-auto', iconSize: 52, textSize: 'text-2xl' },
    xl: { height: 'h-20', width: 'w-auto', iconSize: 80, textSize: 'text-4xl' },
  }[size];

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {/* Exact Vector Replica of the Saka Homes Houses + Swoosh Logo */}
      <svg
        viewBox="0 0 320 220"
        className={`${dimensions.height} w-auto object-contain shrink-0`}
        aria-label="Saka Homes Logo"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Left Roof / House (Orange-Red) */}
        <polygon
          points="100,75 155,120 155,160 85,160 85,110"
          fill="#E54818"
        />
        <rect x="110" y="65" width="12" height="25" fill="#E54818" />

        {/* Main Center & Right Roof / Houses (Orange-Red) */}
        <polygon
          points="160,35 240,100 240,150 135,150"
          fill="#E54818"
        />
        <rect x="150" y="45" width="14" height="35" fill="#E54818" />

        {/* Right House Window Grid */}
        <g fill="#E54818">
          <rect x="202" y="90" width="8" height="8" rx="1" fill="#FFFFFF" />
          <rect x="212" y="90" width="8" height="8" rx="1" fill="#FFFFFF" />
          <rect x="202" y="100" width="8" height="8" rx="1" fill="#FFFFFF" />
          <rect x="212" y="100" width="8" height="8" rx="1" fill="#FFFFFF" />
        </g>

        {/* Foreground Center White House */}
        <polygon
          points="180,90 220,122 220,150 140,150 140,122"
          fill="#FFFFFF"
          stroke="#E54818"
          strokeWidth="3"
        />
        <rect x="175" y="98" width="6" height="12" fill="#FFFFFF" />

        {/* Foreground White House Windows (Orange Grid) */}
        <g fill="#E54818">
          <rect x="148" y="122" width="6" height="6" />
          <rect x="156" y="122" width="6" height="6" />
          <rect x="148" y="130" width="6" height="6" />
          <rect x="156" y="130" width="6" height="6" />
        </g>

        {/* Dark Purple Curved Base Swoosh */}
        <path
          d="M 30,185 Q 160,150 290,170 C 240,192 110,200 30,185 Z"
          fill="#2B1A70"
        />
      </svg>

      {variant !== 'mark' && (
        <div className="flex flex-col">
          <span 
            className={`font-heading tracking-tight font-semibold ${
              variant === 'white' ? 'text-white' : 'text-[#1E1B4B]'
            } ${dimensions.textSize}`}
          >
            Saka Homes
          </span>
          {showSubtitle && (
            <span className={`text-[10px] uppercase font-sans font-semibold tracking-[0.16em] ${
              variant === 'white' ? 'text-orange-400' : 'text-orange-600'
            }`}>
              Inventory System
            </span>
          )}
        </div>
      )}
    </div>
  );
}
