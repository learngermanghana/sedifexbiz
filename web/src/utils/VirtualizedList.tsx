import React, { useMemo, useRef, useState } from 'react'

export type ListChildComponentProps<T> = {
  index: number
  style: React.CSSProperties
  data: T
}

export type FixedSizeListProps<T> = {
  height: number
  itemCount: number
  itemData: T
  itemKey?: (index: number, data: T) => string | number
  itemSize: number
  width?: number | string
  children: (props: ListChildComponentProps<T>) => React.ReactNode
  overscanCount?: number
  outerElementType?: React.ElementType
  innerElementType?: React.ElementType
  className?: string
}

export function FixedSizeList<T>({
  height,
  itemCount,
  itemData,
  itemKey,
  itemSize,
  width = '100%',
  children,
  overscanCount = 4,
  outerElementType: OuterElement = 'div',
  innerElementType: InnerElement = 'div',
  className,
}: FixedSizeListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }

  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemSize) - overscanCount)
    const end = Math.min(
      itemCount,
      Math.ceil((scrollTop + height) / itemSize) + overscanCount,
    )

    return { startIndex: start, endIndex: end }
  }, [height, itemCount, itemSize, overscanCount, scrollTop])

  const items: React.ReactNode[] = []
  for (let index = startIndex; index < endIndex; index += 1) {
    const style: React.CSSProperties = {
      position: 'absolute',
      top: index * itemSize,
      height: itemSize,
      width: '100%',
    }

    items.push(
      <React.Fragment key={itemKey ? itemKey(index, itemData) : index}>
        {children({ index, style, data: itemData })}
      </React.Fragment>,
    )
  }

  return (
    <OuterElement
      ref={scrollRef as React.Ref<HTMLDivElement>}
      style={{ height, width, overflowY: 'auto', position: 'relative' }}
      onScroll={handleScroll}
      className={className}
    >
      <InnerElement style={{ height: itemCount * itemSize, position: 'relative' }}>
        {items}
      </InnerElement>
    </OuterElement>
  )
}
