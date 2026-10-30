import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { RoleBadge } from '@/components/shared/role-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDisplayName, getInitials } from '@/features/profile/lib/display-name'
import { formatDate } from '@/lib/format'
import type { WorkspaceRole } from '@/types/database'

import type { Member } from '../types'
import { MemberActionsMenu } from './MemberActionsMenu'

interface MembersTableProps {
  workspaceId: string
  members: Member[]
  /** The signed-in user's role in this workspace. */
  callerRole: WorkspaceRole | null
  callerUserId: string | undefined
}

/** Members with avatar, name, email, role, joined date and a per-row actions menu. */
export function MembersTable({
  workspaceId,
  members,
  callerRole,
  callerUserId,
}: MembersTableProps) {
  return (
    <Table aria-label="Members">
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className="hidden sm:table-cell">Joined</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const isSelf = member.user_id === callerUserId
          const name = getDisplayName(member.profile)
          return (
            <TableRow key={member.user_id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar>
                    {member.profile?.avatar_url ? (
                      <AvatarImage src={member.profile.avatar_url} alt="" />
                    ) : null}
                    <AvatarFallback>{getInitials(name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {name}
                      {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                    </span>
                    {member.profile?.email && member.profile.email !== name ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {member.profile.email}
                      </span>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <RoleBadge role={member.role} />
              </TableCell>
              <TableCell className="text-muted-foreground hidden sm:table-cell">
                <time dateTime={member.created_at}>{formatDate(member.created_at)}</time>
              </TableCell>
              <TableCell className="text-right">
                <MemberActionsMenu
                  workspaceId={workspaceId}
                  member={member}
                  memberName={name}
                  callerRole={callerRole}
                  isSelf={isSelf}
                />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function MembersTableSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading members">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  )
}
