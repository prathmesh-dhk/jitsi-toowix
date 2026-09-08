/** Tenant administrators can manage only their own workspace's resources. */
export function mayManageResource(user: any, resource: any): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
  const creatorId = typeof resource.createdBy === 'object' && resource.createdBy !== null
    ? (resource.createdBy._id || resource.createdBy.id)
    : resource.createdBy;
  if (String(creatorId) === String(user._id)) return true;
  return user.role === 'COMPANY_ADMIN' && !!user.companyId && !!resource.companyId
    && String(user.companyId) === String(resource.companyId);
}
