# Abby Docker runtime

These files are the source-controlled definition of Dotlocker's durable services on Abby. Real credentials stay in `/vol/nvme/docker/pluto/abby.env` with mode `0600`.

- `compose.infrastructure.yml`: PostgreSQL and Garage. Sandblocks preview/production connect to these over Abby's tailnet.
- `compose.application.yml`: optional direct-host Dotlocker application; Sandblocks does not require it.
- `lifecycle.sh`: validated update, health, logging, backup, and conservative cleanup commands.

## Install or reconcile

```sh
sudo install -d -m 700 /vol/nvme/docker/pluto/{postgres,garage/meta,garage/data,backups,data}
sudo install -m 600 docker/abby/abby.env.example /vol/nvme/docker/pluto/abby.env
sudoedit /vol/nvme/docker/pluto/abby.env
sudo DOTLOCKER_ABBY_ENV_FILE=/vol/nvme/docker/pluto/abby.env docker/abby/lifecycle.sh validate
sudo DOTLOCKER_ABBY_ENV_FILE=/vol/nvme/docker/pluto/abby.env docker/abby/lifecycle.sh up
```

For an existing PostgreSQL cluster, the init script does not run and does not modify roles or databases. Keep the existing Abby credential values. For a new cluster, it creates isolated preview and production roles/databases during first initialization.

Garage needs a one-time layout and key bootstrap after first start. Use `docker exec dotlocker-garage /garage status`, assign the node capacity with the Garage CLI, then create separate preview and production buckets/keys. Put only those resulting scoped credentials in Sandblocks managed environments or Abby's root-only env file.

## Safe maintenance

```sh
# Build from updated pinned bases, replace containers, await health.
sudo docker/abby/lifecycle.sh update

# Logical PostgreSQL backup; verify before upgrades.
sudo docker/abby/lifecycle.sh backup-postgres

sudo docker/abby/lifecycle.sh status
sudo docker/abby/lifecycle.sh logs garage
sudo docker/abby/lifecycle.sh prune
```

The lifecycle script never removes volumes. It refuses to stop durable infrastructure unless `DOTLOCKER_CONFIRM_STOP_INFRA=YES` is explicitly provided. PostgreSQL major-version upgrades require a tested `pg_dump`/restore or `pg_upgrade`; do not change `POSTGRES_VERSION` across majors and run `update` blindly.
