from pydantic_settings import BaseSettings, SettingsConfigDict
import boto3

class Settings(BaseSettings):
    database_url : str
    redis_url : str
    jwt_secret : str
    jwt_algorithm : str
    access_token_expire_minutes : int
    refresh_token_expire_days : int
    s3_bucket_name : str
    aws_access_key_id : str
    aws_secret_access_key : str
    aws_region : str
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()    

s3_client = boto3.client(
    "s3",
    aws_access_key_id=settings.aws_access_key_id,
    aws_secret_access_key=settings.aws_secret_access_key,
    region_name=settings.aws_region
)


async def verify_bucket():
    try:
        s3_client.head_bucket(Bucket=settings.s3_bucket_name)
    except Exception as e:
        raise RuntimeError(
            f"S3 bucket '{settings.s3_bucket_name}' is not reachable with the "
            f"configured AWS credentials: {e}"
        ) from e


def presigned_put_url(bucket_name: str, object_name: str, expiration: int = 3600):
    try:
        response = s3_client.generate_presigned_url(
            'put_object',
            Params={'Bucket': bucket_name, 'Key': object_name},
            ExpiresIn=expiration
        )
        return response
    except Exception as e:
        print(f"Error generating presigned URL: {e}")
        return None


def presigned_get_url(bucket_name: str, object_name: str, expiration: int = 3600):
    try:
        response = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': object_name},
            ExpiresIn=expiration
        )
        return response
    except Exception as e:
        print(f"Error generating presigned URL: {e}")
        return None