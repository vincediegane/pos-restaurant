def migrate(cr, version):
    # Les roles multi-restaurant (manager parent / manager succursale)
    # sont fusionnes en un seul role "manager".
    cr.execute(
        """
        UPDATE res_users
        SET resto_role = 'manager'
        WHERE resto_role IN ('manager_parent', 'manager_branch')
        """
    )
