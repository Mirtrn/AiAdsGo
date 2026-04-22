SELECT count(*) as pending_count FROM url_swap_tasks ust
JOIN users u ON u.id = ust.user_id
WHERE ust.status = 'enabled'
AND ust.next_swap_at <= CURRENT_TIMESTAMP
AND ust.started_at <= CURRENT_TIMESTAMP
AND (ust.is_deleted = FALSE OR ust.is_deleted IS NULL)
AND u.is_active = TRUE;

SELECT ust.id, ust.next_swap_at, ust.started_at, ust.is_deleted, u.is_active, u.package_expires_at
FROM url_swap_tasks ust
JOIN users u ON u.id = ust.user_id
WHERE ust.status = 'enabled'
ORDER BY ust.next_swap_at ASC
LIMIT 5;
