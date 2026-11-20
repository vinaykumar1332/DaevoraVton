import { cn } from '../../../lib/utils.js';
import './Card.css';

export function Card({ className, children, ...props }) {
  return <div className={cn('ui-card', className)} {...props}>{children}</div>;
}

export function CardHeader({ className, children, ...props }) {
  return <div className={cn('ui-card-header', className)} {...props}>{children}</div>;
}

export function CardTitle({ className, children, as: Tag = 'h3', ...props }) {
  return <Tag className={cn('ui-card-title', className)} {...props}>{children}</Tag>;
}

export function CardDescription({ className, children, ...props }) {
  return <p className={cn('ui-card-desc', className)} {...props}>{children}</p>;
}

export function CardBody({ className, children, ...props }) {
  return <div className={cn('ui-card-body', className)} {...props}>{children}</div>;
}

export function CardFooter({ className, children, ...props }) {
  return <div className={cn('ui-card-footer', className)} {...props}>{children}</div>;
}
