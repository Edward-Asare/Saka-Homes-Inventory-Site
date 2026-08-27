import { useState, useEffect, useCallback, useRef } from 'react';

interface InactivityTimeoutOptions {
  /**
   * Total timeout duration before logout in milliseconds.
   * Default: 15 minutes (15 * 60 * 1000 ms)
   */
  timeoutMs?: number;
  /**
   * Warning countdown duration before final logout in milliseconds.
   * Default: 60 seconds (60 * 1000 ms)
   */
  warningMs?: number;
  /**
   * Callback executed when inactivity expires and user is logged out.
   */
  onTimeout: () => void;
  /**
   * Whether the inactivity tracking is actively running.
   */
  enabled?: boolean;
}

const STORAGE_KEY_LAST_ACTIVITY = 'saka_last_activity_timestamp';

export function useInactivityTimeout({
  timeoutMs = 15 * 60 * 1000, // 15 minutes
  warningMs = 60 * 1000,       // 60 seconds warning
  onTimeout,
  enabled = true
}: InactivityTimeoutOptions) {
  const [isWarning, setIsWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.floor(warningMs / 1000));
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const updateLastActivity = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, Date.now().toString());
    } catch {
      // Ignore localStorage exceptions in private browsing if restricted
    }
  }, []);

  const resetTimer = useCallback(() => {
    setIsWarning(false);
    setRemainingSeconds(Math.floor(warningMs / 1000));
    updateLastActivity();
  }, [updateLastActivity, warningMs]);

  useEffect(() => {
    if (!enabled) {
      setIsWarning(false);
      return;
    }

    // Initialize activity timestamp if not present
    const existing = localStorage.getItem(STORAGE_KEY_LAST_ACTIVITY);
    if (!existing) {
      updateLastActivity();
    }

    let lastThrottledTime = 0;
    const handleUserActivity = () => {
      const now = Date.now();
      // Throttle activity updates to once every 2 seconds for performance
      if (now - lastThrottledTime > 2000) {
        lastThrottledTime = now;
        // Only update if we are not currently in the warning countdown
        // (in warning state, the user must explicitly click "Stay Signed In" or interact)
        updateLastActivity();
      }
    };

    // User activity listeners
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel', 'click'];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    // Check inactivity every 1000ms
    const checkInterval = setInterval(() => {
      let lastActivity = Date.now();
      try {
        const stored = localStorage.getItem(STORAGE_KEY_LAST_ACTIVITY);
        if (stored) {
          lastActivity = parseInt(stored, 10) || Date.now();
        }
      } catch {
        // fallback
      }

      const elapsed = Date.now() - lastActivity;
      const warningThreshold = timeoutMs - warningMs;

      if (elapsed >= timeoutMs) {
        // Inactivity exceeded total timeout -> trigger auto logout
        setIsWarning(false);
        onTimeoutRef.current();
      } else if (elapsed >= warningThreshold) {
        // Within the warning window
        setIsWarning(true);
        const timeLeftMs = Math.max(0, timeoutMs - elapsed);
        setRemainingSeconds(Math.ceil(timeLeftMs / 1000));
      } else {
        // Active and within safe range
        setIsWarning(false);
      }
    }, 1000);

    // Cross-tab storage listener to sync activity between tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_LAST_ACTIVITY && e.newValue) {
        const last = parseInt(e.newValue, 10);
        const elapsed = Date.now() - last;
        if (elapsed < timeoutMs - warningMs) {
          setIsWarning(false);
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      clearInterval(checkInterval);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity);
      });
      window.removeEventListener('storage', handleStorage);
    };
  }, [enabled, timeoutMs, warningMs, updateLastActivity]);

  return {
    isWarning,
    remainingSeconds,
    resetTimer
  };
}
