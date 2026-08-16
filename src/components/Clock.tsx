'use client';

import React from 'react';

interface ClockProps {
  time: number; // seconds
  active: boolean;
  className?: string;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '∞';
  if (seconds < 0) seconds = 0;
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  if (seconds < 10) {
    const tenths = Math.floor((seconds * 10) % 10);
    return `${secs}.${tenths}`;
  }
  
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function Clock({ time, active, className = '' }: ClockProps) {
  const isInfinity = !isFinite(time);
  const isLow = isFinite(time) && time <= 30;
  const isCritical = isFinite(time) && time <= 10;

  const stateClass = [
    'clock',
    active ? 'active' : '',
    isInfinity ? 'infinity' : '',
    isCritical ? 'critical' : isLow ? 'low' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={stateClass} role="timer" aria-label={active ? 'Active clock' : 'Clock'}>
      {formatTime(time)}
    </div>
  );
}
