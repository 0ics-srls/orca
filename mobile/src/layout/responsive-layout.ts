import { useWindowDimensions } from 'react-native'
import {
  getResponsiveLayoutMetrics,
  type ResponsiveLayoutMetrics
} from './responsive-layout-metrics'

export function useResponsiveLayout(): ResponsiveLayoutMetrics {
  const { width, height } = useWindowDimensions()
  return getResponsiveLayoutMetrics(width, height)
}
