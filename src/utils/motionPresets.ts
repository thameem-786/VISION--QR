import type { MotionProps, Transition } from 'motion/react';

export const SPRING_INTERACTIVE: Transition = {
  type: 'spring',
  stiffness: 460,
  damping: 28,
  mass: 0.7,
};

export const SPRING_PANEL: Transition = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1],
};

export const BUTTON_SPRING_PROPS: Pick<
  MotionProps,
  'whileHover' | 'whileTap' | 'transition'
> = {
  whileHover: { y: -1.5, scale: 1.015 },
  whileTap: { scale: 0.965, y: 0 },
  transition: SPRING_INTERACTIVE,
};

export const NAV_SPRING_PROPS: Pick<
  MotionProps,
  'whileHover' | 'whileTap' | 'transition'
> = {
  whileHover: { x: 3 },
  whileTap: { scale: 0.975 },
  transition: SPRING_INTERACTIVE,
};
