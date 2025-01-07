export const testDbRules = {
  users: {
    masks: {
      first_name: 'anon.fake_first_name()',
      last_name: 'anon.fake_last_name()',
      email: 'anon.partial_email(email)',
      password_hash: `anon.random_string(5)`,
      created_at: 'anon.random_date()',
      date_of_birth: 'anon.random_date()',
      last_login: 'anon.random_date()'
    }
  }
}